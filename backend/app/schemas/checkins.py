from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CheckinScanIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    credential: str | None = Field(default=None, min_length=1, max_length=300)
    registration_reference: str | None = Field(default=None, min_length=4, max_length=80)

    @model_validator(mode="after")
    def require_one_credential(self) -> "CheckinScanIn":
        credential = self.credential.strip() if self.credential else None
        reference = self.registration_reference.strip().upper() if self.registration_reference else None
        if bool(credential) == bool(reference):
            raise ValueError("Provide exactly one ticket credential or registration reference")
        self.credential = credential
        self.registration_reference = reference
        return self
