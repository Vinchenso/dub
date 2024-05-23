import { DubApiError } from "@/lib/api/errors";
import { parseRequestBody } from "@/lib/api/utils";
import { withWorkspaceEdge } from "@/lib/auth/workspace-edge";
import { prismaEdge } from "@/lib/prisma/edge";
import { getLeadEvent, recordSale } from "@/lib/tinybird";
import { clickEventSchemaTB } from "@/lib/zod/schemas/clicks";
import {
  trackSaleRequestSchema,
  trackSaleResponseSchema,
} from "@/lib/zod/schemas/sales";
import { nanoid } from "@dub/utils";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// POST /api/track/sale – Track a sale conversion event
export const POST = withWorkspaceEdge(
  async ({ req, workspace }) => {
    const {
      customerId: externalId,
      paymentProcessor,
      invoiceId,
      amount,
      currency,
      metadata,
    } = trackSaleRequestSchema.parse(await parseRequestBody(req));

    // Find customer
    const customer = await prismaEdge.customer.findUnique({
      where: {
        projectId_externalId: {
          projectId: workspace.id,
          externalId,
        },
      },
    });

    if (!customer) {
      throw new DubApiError({
        code: "not_found",
        message: `Customer not found for customerId: ${externalId}`,
      });
    }

    // Find lead
    const leadEvent = await getLeadEvent({ customerId: customer.id });

    if (!leadEvent || leadEvent.data.length === 0) {
      throw new DubApiError({
        code: "not_found",
        message: `Lead event not found for customerId: ${customer.id}`,
      });
    }

    const clickData = clickEventSchemaTB
      .omit({ timestamp: true })
      .parse(leadEvent.data[0]);

    await recordSale({
      ...clickData,
      event_id: nanoid(16),
      customer_id: customer.id,
      payment_processor: paymentProcessor,
      amount,
      currency,
      invoice_id: invoiceId || "",
      metadata: metadata ? JSON.stringify(metadata) : "",
    });

    const response = trackSaleResponseSchema.parse({
      customerId: externalId,
      paymentProcessor,
      amount,
      currency,
      invoiceId,
      metadata,
    });

    return NextResponse.json(response, { status: 201 });
  },
  { betaFeature: true },
);
