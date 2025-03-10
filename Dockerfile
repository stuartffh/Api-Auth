# Usa uma imagem leve e segura
FROM node:18-alpine

# Cria um usuário não-root para rodar a aplicação
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Define o diretório de trabalho dentro do container
WORKDIR /app

# Copia os arquivos de dependências primeiro para aproveitar o cache
COPY package*.json ./

# Ajusta permissões antes de instalar pacotes (para evitar `chown` demorado)
RUN chown -R appuser:appgroup /app

# Instala pacotes sem devDependencies e usa cache local para otimizar o tempo de build
RUN npm ci --omit=dev --prefer-offline

# Copia o restante dos arquivos da aplicação
COPY . .

# Garante que os arquivos pertencem ao usuário correto
RUN chown -R appuser:appgroup /app

# Muda para usuário não-root para maior segurança
USER appuser

# Expõe a porta usada pelo servidor
EXPOSE 4000

# Adiciona um healthcheck para reiniciar automaticamente se o servidor travar
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:4000/health || exit 1

# Define o comando padrão de inicialização
CMD ["npm", "start"]
