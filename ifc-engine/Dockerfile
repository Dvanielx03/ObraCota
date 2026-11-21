FROM python:3.12-slim
WORKDIR /srv
RUN pip install --no-cache-dir ifcopenshell==0.9.0.post1 fastapi==0.129.0 uvicorn==0.41.0
COPY engine.py .
USER 10001
CMD ["uvicorn","engine:app","--host","0.0.0.0","--port","8000","--workers","1"]
