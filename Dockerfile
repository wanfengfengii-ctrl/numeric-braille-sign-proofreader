# 校样台一体化镜像：web 服务与 verify 验收服务共用
# 基础镜像自带 Chromium 与 Playwright 运行依赖，与 @playwright/test 1.48.2 对应
FROM mcr.microsoft.com/playwright:v1.48.2-jammy

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3000

# 默认启动开发服务器（web 服务）；verify 服务以 command 覆盖
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"]
