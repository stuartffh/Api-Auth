# Usa a imagem oficial do Node.js
FROM node:18

# Define o diretório de trabalho dentro do container
WORKDIR /app

# Define variável de ambiente para produção
ENV NODE_ENV=production

# Copia os arquivos de dependências primeiro (para aproveitar cache do Docker)
#COPY package*.json ./

# Instala as dependências
RUN npm ci --only=production

# Copia o restante dos arquivos da aplicação
#COPY config/ ./config/
#COPY middleware/ ./middleware/
#COPY routes/ ./routes/
#COPY services/ ./services/
#COPY utils/ ./utils/
#COPY server.js ./

# Expõe a porta 4000 (ou a porta definida no .env)
EXPOSE 4000

# Comando para iniciar a aplicação
CMD ["node", "server.js"]

