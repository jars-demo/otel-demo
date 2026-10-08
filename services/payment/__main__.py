from common.app import run
from payment.main import SERVICE_NAME, VERSION

run("payment.main:app", SERVICE_NAME, VERSION)
