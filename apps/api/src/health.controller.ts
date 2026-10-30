import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { HealthResponse } from "@orbit/contracts";

@ApiTags("health")
@Controller("health")
export class HealthController {
  @Get()
  @ApiOperation({ summary: "Check that the API process is responding" })
  getHealth(): HealthResponse {
    return { status: "ok", service: "orbit-api" };
  }
}
