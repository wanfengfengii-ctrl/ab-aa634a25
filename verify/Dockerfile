# 浏览器验收一次性服务：基于官方 Playwright 镜像（已内置与库版本匹配的 Chromium）
FROM mcr.microsoft.com/playwright:v1.47.2-jammy
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /e2e
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY run-tests.mjs ./
CMD ["node", "run-tests.mjs"]
