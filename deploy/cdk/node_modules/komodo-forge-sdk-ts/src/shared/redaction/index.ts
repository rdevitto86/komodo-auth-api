import fastRedact from 'fast-redact';

export const redact = fastRedact({
	paths: [
		'password',
		'token',
		'apiKey',
		'secret',
		'authorization',
		'creditCard',
		'cardNumber',
		'cvv',
		'ssn',
		'pin',
		'email',
		'phone',
		'address',
		'*.password',
		'*.token',
		'*.cardNumber',
		'*.email',
	],
	censor: '[REDACTED]',
	serialize: false,
});
