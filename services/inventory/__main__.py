from common.app import run
from inventory.main import SERVICE_NAME, VERSION

run("inventory.main:app", SERVICE_NAME, VERSION)
