const logger = require('../utils/logger');

class RateLimiter {
    constructor(maxAttempts = 5, windowMs = 60000) {
        this.maxAttempts = maxAttempts;
        this.windowMs = windowMs;
        this.attempts = new Map();
    }

    getClientIP(req) {
        return req.ip || 
               req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
               req.connection.remoteAddress || 
               'unknown';
    }

    cleanup() {
        const now = Date.now();
        for (const [ip, data] of this.attempts.entries()) {
            if (now - data.resetTime > this.windowMs) {
                this.attempts.delete(ip);
            }
        }
    }

    middleware() {
        return (req, res, next) => {
            this.cleanup();
            const ip = this.getClientIP(req);
            const now = Date.now();
            const clientData = this.attempts.get(ip);

            if (!clientData) {
                this.attempts.set(ip, {
                    count: 1,
                    resetTime: now + this.windowMs
                });
                return next();
            }

            if (now > clientData.resetTime) {
                this.attempts.set(ip, {
                    count: 1,
                    resetTime: now + this.windowMs
                });
                return next();
            }

            if (clientData.count >= this.maxAttempts) {
                logger.warn('Rate limit excedido', {
                    ip,
                    attempts: clientData.count,
                    resetTime: new Date(clientData.resetTime).toISOString()
                });
                return res.status(429).json({
                    success: false,
                    error: 'Muitas tentativas. Tente novamente em alguns instantes.',
                    retryAfter: Math.ceil((clientData.resetTime - now) / 1000)
                });
            }

            clientData.count++;
            next();
        };
    }

    reset(ip) {
        this.attempts.delete(ip);
    }
}

module.exports = RateLimiter;

