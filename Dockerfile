FROM node:22-alpine

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Dummy URL only so prisma.config.ts can load during generate (not used for real connections)
ARG DATABASE_URL="postgresql://postgres:password@database:5432/deadlinehub"
RUN pnpm exec prisma generate

EXPOSE 5000

CMD ["pnpm", "dev"]