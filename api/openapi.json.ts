import fs from "fs";
import { mergeOpenapis } from "openapi-util";
import path from "path";

export const GET = async (request: Request) => {
  const originUrl = new URL(request.url).origin;

  const operations = path.join(process.cwd(), "public/operations");
  const names = fs.readdirSync(operations, "utf8");
  const result = await mergeOpenapis({
    openapiList: names
      .filter((x) => x.endsWith(".json"))
      .map((filename) => ({
        openapiUrl: `${originUrl}/operations/${filename}`,
        operationIds: undefined,
      })),
  });
  return new Response(JSON.stringify(result, undefined, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
