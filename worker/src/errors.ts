// Transport-agnostic error types, mapped to HTTP in one place (see index.ts).
// Nothing here ever carries a secret.

export class TranslatorError extends Error {
  statusCode = 500;
  code = "internal_error";
  details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

export class MissingCredentialsError extends TranslatorError {
  statusCode = 401;
  code = "missing_credentials";
}

export class ForbiddenError extends TranslatorError {
  statusCode = 403;
  code = "forbidden";
}

export class InvalidCredentialsError extends TranslatorError {
  statusCode = 401;
  code = "invalid_credentials";
}

export class LoginNotConfiguredError extends TranslatorError {
  statusCode = 501;
  code = "login_not_configured";
}

export class RotationUnavailableError extends TranslatorError {
  statusCode = 501;
  code = "rotation_unavailable";
}

export class ConfigError extends TranslatorError {
  statusCode = 500;
  code = "config_error";
}

export class InvalidRequestError extends TranslatorError {
  statusCode = 422;
  code = "invalid_request";
}

export class ProviderError extends TranslatorError {
  statusCode = 502;
  code = "provider_error";
  upstreamStatus?: number;

  constructor(
    message: string,
    upstreamStatus?: number,
    details: Record<string, unknown> = {},
  ) {
    super(message, details);
    this.upstreamStatus = upstreamStatus;
    // Surface upstream auth / rate-limit failures faithfully, without the key.
    if (upstreamStatus === 401 || upstreamStatus === 403) {
      this.statusCode = upstreamStatus;
      this.code = "provider_unauthorized";
    } else if (upstreamStatus === 429) {
      this.statusCode = 429;
      this.code = "provider_rate_limited";
    }
  }
}
