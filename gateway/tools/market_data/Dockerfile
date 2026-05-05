FROM public.ecr.aws/lambda/python:3.13-arm64

WORKDIR ${LAMBDA_TASK_ROOT}

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright Chromium and its system dependencies
RUN playwright install chromium --with-deps

COPY lambda_function.py .

CMD ["lambda_function.handler"]
