from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers.outlier import router as outlier_router
from routers.nk_library import router as nk_router
from routers.model import router as model_router
from routers.transfer import router as transfer_router
from routers.spectrum import router as spectrum_router
from routers.optimization import router as optimization_router
from routers.workspace_cache import router as workspace_cache_router
from routers.recipe_hub import router as recipe_hub_router
from routers.mock_hpc import router as mock_hpc_router

app = FastAPI(title="OCD Algorithm API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(outlier_router, prefix="/api")
app.include_router(nk_router, prefix="/api")
app.include_router(model_router, prefix="/api")
app.include_router(transfer_router, prefix="/api")
app.include_router(spectrum_router, prefix="/api")
app.include_router(optimization_router, prefix="/api")
app.include_router(workspace_cache_router, prefix="/api")
app.include_router(recipe_hub_router, prefix="/api")
app.include_router(mock_hpc_router)
