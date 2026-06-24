# BUILD_TARGET selects which cmd entrypoint to compile.
# Values: "public" (default, port 7011) | "private" (port 7012, shared network namespace)
ARG BUILD_TARGET=public
ARG DISTROLESS_TAG=debug

FROM golang:1.26 AS build
ARG BUILD_TARGET

WORKDIR /app

COPY komodo-auth-api/go.mod komodo-auth-api/go.sum ./
RUN go mod download

COPY komodo-auth-api ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /bin/komodo ./cmd/${BUILD_TARGET}

FROM gcr.io/distroless/static-debian12:${DISTROLESS_TAG}
COPY --from=build /bin/komodo /komodo
COPY --from=build /app/internal/config/validation_rules.yaml /app/config/validation_rules.yaml
EXPOSE 7011 7012
ENTRYPOINT ["/komodo"]
