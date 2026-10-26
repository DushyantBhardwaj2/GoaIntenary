"""AWS HTTP API adapter; independent from the core's private database."""
from mangum import Mangum

from .main import app

handler = Mangum(app, lifespan="off")
