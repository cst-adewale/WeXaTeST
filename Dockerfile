# Stage 1: Build the React frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY adewaleai/package*.json ./
RUN npm ci
COPY adewaleai/ ./
# Set VITE_API_URL as empty so it defaults to the same domain (relative paths)
ENV VITE_API_URL=""
RUN npm run build

# Stage 2: Package the frontend and run the FastAPI backend
FROM python:3.11-slim
WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./

# Copy built frontend assets to the backend's static folder
COPY --from=frontend-builder /app/frontend/dist ./static

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
