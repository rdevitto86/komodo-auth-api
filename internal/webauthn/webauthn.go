package webauthn

import (
	"fmt"
	"strings"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
)

const RPDisplayName = "Komodo" // human readable name for RPID

type Config struct {
	RPID    string // relying party ID (aka domain)
	Origins string // RPID origins (full origin URLs, comma-separated)
}

func New(cfg Config) (*webauthn.WebAuthn, error) {
	if cfg.RPID == "" {
		return nil, fmt.Errorf("failed to configure webauthn relying party: missing RPID")
	}

	var origins []string
	for o := range strings.SplitSeq(cfg.Origins, ",") {
		o = strings.TrimSpace(o)
		if o != "" {
			origins = append(origins, o)
		}
	}
	if len(origins) == 0 {
		return nil, fmt.Errorf("failed to configure webauthn relying party: missing origins")
	}

	wa, err := webauthn.New(&webauthn.Config{
		RPID:                  cfg.RPID,
		RPDisplayName:         RPDisplayName,
		RPOrigins:             origins,
		AttestationPreference: protocol.PreferNoAttestation, // proof of device
		AuthenticatorSelection: protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementPreferred, // credential discoverability
			UserVerification: protocol.VerificationRequired,            // biometric/pin required
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to configure webauthn relying party: %w", err)
	}
	return wa, nil
}

type RegistrationUser struct {
	ID          []byte
	Name        string
	DisplayName string
	Credentials []webauthn.Credential
}

func (u *RegistrationUser) WebAuthnID() []byte                         { return u.ID }
func (u *RegistrationUser) WebAuthnName() string                       { return u.Name }
func (u *RegistrationUser) WebAuthnDisplayName() string                { return u.DisplayName }
func (u *RegistrationUser) WebAuthnCredentials() []webauthn.Credential { return u.Credentials }
