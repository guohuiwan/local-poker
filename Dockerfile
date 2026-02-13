FROM docker.tkamc.domain:80/runtime/alpine3.18/node18.17.0:0.0.1

WORKDIR /app

# 设置 npm registry
RUN npm config set registry http://repo.itops.tkamc.com:8081/repository/npm-mirror/

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
