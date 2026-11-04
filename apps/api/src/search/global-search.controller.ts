import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { GlobalSearchResponse } from "@orbit/contracts";
import { AuthGuard } from "../auth/auth.guard";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { GlobalSearchService } from "./global-search.service";

@ApiTags("search")
@UseGuards(AuthGuard)
@Controller("search")
export class GlobalSearchController {
  constructor(private readonly search: GlobalSearchService) {}

  @Get()
  @ApiOperation({ summary: "Search projects and tasks accessible to the signed-in user" })
  searchContent(
    @Req() request: AuthenticatedRequest,
    @Query("q") query?: string,
  ): Promise<GlobalSearchResponse> {
    return this.search.search(request.user!.id, query);
  }
}
