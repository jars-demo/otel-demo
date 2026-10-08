from common.app import run
from orders.main import SERVICE_NAME, VERSION

run("orders.main:app", SERVICE_NAME, VERSION)
