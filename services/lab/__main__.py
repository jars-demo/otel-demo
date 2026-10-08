import os

import uvicorn

from common.logs import setup_logging
from lab.main import SERVICE_NAME

setup_logging(SERVICE_NAME)
uvicorn.run("lab.main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), log_config=None)
