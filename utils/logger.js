const logger = {
    info: (message, context = {}) => {
        const log = {
            timestamp: new Date().toISOString(),
            level: 'INFO',
            message,
            ...context
        };
        console.log(JSON.stringify(log));
    },

    warn: (message, context = {}) => {
        const log = {
            timestamp: new Date().toISOString(),
            level: 'WARN',
            message,
            ...context
        };
        console.warn(JSON.stringify(log));
    },

    error: (message, error = null, context = {}) => {
        const log = {
            timestamp: new Date().toISOString(),
            level: 'ERROR',
            message,
            error: error ? {
                message: error.message,
                stack: error.stack,
                code: error.code
            } : null,
            ...context
        };
        console.error(JSON.stringify(log));
    },

    maskEmail: (email) => {
        if (!email || !email.includes('@')) return email;
        const [local, domain] = email.split('@');
        const maskedLocal = local.length > 2 
            ? local.substring(0, 2) + '*'.repeat(Math.min(local.length - 2, 4))
            : '*'.repeat(local.length);
        return `${maskedLocal}@${domain}`;
    }
};

module.exports = logger;

