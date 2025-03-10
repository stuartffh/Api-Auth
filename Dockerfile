# Usa uma imagem menor e mais segura
FROM node:18-alpine

# Cria um usuário não-root para rodar a aplicação
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Define o diretório de trabalho dentro do container
WORKDIR /app

# Copia apenas os arquivos necessários para instalar as dependências
COPY package*.json ./

# Instala as dependências com `npm ci` (garante versões exatas)
RUN npm ci --only=production

# Copia o restante dos arquivos da aplicação
COPY . .

# Define permissões para o usuário não-root
RUN chown -R appuser:appgroup /app

# Define o usuário que executará o container
USER appuser

# Expõe a porta 4000 (ou a porta definida no .env)
EXPOSE 4000

# Adiciona um healthcheck para garantir que o container está rodando corretamente
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:4000/health || exit 1

# Comando para iniciar a aplicação
CMD ["npm", "start"]
