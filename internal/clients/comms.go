package clients

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	commsmodels "komodo-auth-api/internal/models/comms"

	logger "github.com/rdevitto86/komodo-forge-sdk-go/logging/runtime"
)

const (
	maxConcurrentEmails = 20
	sendEmailTimeout    = 10 * time.Second
)

func (c *HttpClient) SendEmail(ctx context.Context, body commsmodels.SendEmailJSONRequestBody) error {
	detachedCtx := context.WithoutCancel(ctx)
	logAttrs := logger.FromContext(detachedCtx)

	sem := c.emailSemaphore()
	select {
	case sem <- struct{}{}: // Acquire semaphore
	default:
		logger.Warn("dropping email send: concurrency limit reached", logAttrs...)
		return nil
	}

	go func() {
		defer func() { <-sem }() // Release semaphore
		defer func() {
			if r := recover(); r != nil {
				logger.Error("panic in send email goroutine", fmt.Errorf("%v", r), logAttrs...)
			}
		}()

		timeoutCtx, cancel := context.WithTimeout(detachedCtx, sendEmailTimeout)
		defer cancel()

		payload, err := json.Marshal(body)
		if err != nil {
			logger.Error("failed to marshal email request body", err, logAttrs...)
			return
		}

		req, err := http.NewRequestWithContext(
			timeoutCtx,
			http.MethodPost,
			c.CommsBaseURL+commsmodels.PathSendEmail,
			bytes.NewReader(payload),
		)
		if err != nil {
			logger.Error("failed to build email request", err, logAttrs...)
			return
		}

		req.GetBody = func() (io.ReadCloser, error) {
			return io.NopCloser(bytes.NewReader(payload)), nil
		}

		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")

		resp, err := c.Do(req)
		if err != nil {
			logger.Error("failed to send email request", err, logAttrs...)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			io.Copy(io.Discard, resp.Body) //nolint:errcheck
			logger.Error(
				"email upstream returned non-2xx",
				fmt.Errorf("status %d", resp.StatusCode),
				append(logger.FromContext(detachedCtx), logger.Attr("status_code", resp.StatusCode))...,
			)
		}
	}()

	return nil
}
