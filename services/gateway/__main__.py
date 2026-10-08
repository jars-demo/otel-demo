from common.app import run
from gateway.main import SERVICE_NAME, VERSION

run("gateway.main:app", SERVICE_NAME, VERSION)
