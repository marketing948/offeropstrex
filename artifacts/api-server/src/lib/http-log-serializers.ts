export function serializeHttpRequest(req: {
  id?: string | number;
  method?: string;
  url?: string;
}) {
  return {
    id: req.id,
    method: req.method,
    url: req.url?.split("?")[0],
  };
}

export function serializeHttpResponse(res: { statusCode?: number }) {
  return {
    statusCode: res.statusCode,
  };
}
