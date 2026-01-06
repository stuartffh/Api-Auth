const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const logger = require('../utils/logger');

class Database {
    constructor(dbPath = './auth_logs.db') {
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                logger.error('Erro ao conectar ao banco de dados', err);
                throw err;
            }
            logger.info('Banco de dados conectado', { path: dbPath });
        });
        
        this.initializeTables();
    }

    initializeTables() {
        this.db.serialize(() => {
            this.db.run(`
                CREATE TABLE IF NOT EXISTS login_logs (
                    id INTEGER PRIMARY KEY, 
                    email TEXT, 
                    login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP, 
                    success INTEGER, 
                    ip TEXT, 
                    otp_code TEXT
                )
            `, (err) => {
                if (err) {
                    logger.error('Erro ao criar tabela login_logs', err);
                } else {
                    logger.info('Tabela login_logs verificada/criada');
                }
            });

            this.db.run(`
                CREATE TABLE IF NOT EXISTS user_tokens (
                    email TEXT PRIMARY KEY, 
                    accessToken TEXT, 
                    idToken TEXT, 
                    refreshToken TEXT, 
                    expiresAt INTEGER
                )
            `, (err) => {
                if (err) {
                    logger.error('Erro ao criar tabela user_tokens', err);
                } else {
                    logger.info('Tabela user_tokens verificada/criada');
                }
            });
        });
    }

    async run(query, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(query, params, function(err) {
                if (err) {
                    logger.error('Erro ao executar query', err, { query, params });
                    reject(err);
                } else {
                    resolve({ lastID: this.lastID, changes: this.changes });
                }
            });
        });
    }

    async get(query, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(query, params, (err, row) => {
                if (err) {
                    logger.error('Erro ao buscar dados', err, { query, params });
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async all(query, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(query, params, (err, rows) => {
                if (err) {
                    logger.error('Erro ao buscar múltiplos dados', err, { query, params });
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async saveLog(email, success, ip, otp = null) {
        try {
            await this.run(
                `INSERT INTO login_logs (email, success, ip, otp_code) VALUES (?, ?, ?, ?)`,
                [email, success ? 1 : 0, ip, otp]
            );
            logger.info('Log de login salvo', { email: logger.maskEmail(email), success, ip });
        } catch (error) {
            logger.error('Erro ao salvar log de login', error, { email: logger.maskEmail(email) });
            throw error;
        }
    }

    async saveTokens(email, accessToken, idToken, refreshToken, expiresAt) {
        if (!accessToken || !idToken || !refreshToken) {
            const error = new Error('Dados de tokens inválidos');
            logger.error('Erro ao salvar tokens: dados inválidos', error, { email: logger.maskEmail(email) });
            throw error;
        }

        try {
            await this.run(
                `INSERT INTO user_tokens (email, accessToken, idToken, refreshToken, expiresAt) 
                 VALUES (?, ?, ?, ?, ?) 
                 ON CONFLICT(email) DO UPDATE SET 
                     accessToken = excluded.accessToken, 
                     idToken = excluded.idToken, 
                     refreshToken = excluded.refreshToken, 
                     expiresAt = excluded.expiresAt`,
                [email, accessToken, idToken, refreshToken, expiresAt]
            );
            logger.info('Tokens salvos no banco de dados', { email: logger.maskEmail(email) });
        } catch (error) {
            logger.error('Erro ao salvar tokens', error, { email: logger.maskEmail(email) });
            throw error;
        }
    }

    async getTokens(email) {
        try {
            const tokens = await this.get(`SELECT * FROM user_tokens WHERE email = ?`, [email]);
            return tokens;
        } catch (error) {
            logger.error('Erro ao buscar tokens', error, { email: logger.maskEmail(email) });
            throw error;
        }
    }

    close() {
        return new Promise((resolve, reject) => {
            this.db.close((err) => {
                if (err) {
                    logger.error('Erro ao fechar banco de dados', err);
                    reject(err);
                } else {
                    logger.info('Banco de dados fechado');
                    resolve();
                }
            });
        });
    }
}

module.exports = Database;

