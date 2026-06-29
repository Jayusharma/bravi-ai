from pydantic import BaseModel, ConfigDict, Field


class QualifyRequest(BaseModel):
    # `from` is a Python keyword, so we receive it via an alias.
    # populate_by_name lets us also build the model with `from_` internally.
    model_config = ConfigDict(populate_by_name=True)

    body: str
    from_: str = Field(alias="from")
    channel: str
    business_id: str | None = None


class ExtractedData(BaseModel):
    contactName: str | None = None
    companyName: str | None = None
    productRequested: str | None = None
    quantitySignal: str | None = None
    areaLocality: str | None = None
    budgetSignal: str | None = None
    timelineSignal: str | None = None


class QualifyResponse(BaseModel):
    isLead: bool
    confidence: int          # 0-100
    intent: str              # e.g. PRODUCT_INQUIRY, PRICING_REQUEST
    urgency: int             # 1-5
    priority: int            # 1-10
    reason: str
    extractedData: ExtractedData
    detectedLanguage: str
    inputTokens: int
    outputTokens: int
