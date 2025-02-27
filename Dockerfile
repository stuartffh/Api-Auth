# Usa a imagem oficial do Node.js
FROM node:18

# Define o diretório de trabalho dentro do container
WORKDIR /app

# Copia os arquivos necessários
COPY package*.json ./

# Instala as dependências
RUN npm install

# Copia o restante dos arquivos
COPY . .

# Expõe a porta 4000 (ou a porta definida no .env)
EXPOSE 4000

# Comando para iniciar a aplicação
CMD ["node", "server.js"]
