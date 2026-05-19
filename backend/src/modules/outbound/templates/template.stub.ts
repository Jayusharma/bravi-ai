/**
 * Stub for the future TemplateModule.
 * Replace this with a real injection token + TemplateService when that module is built.
 * The interface contract here matches ARCHITECTURE.md's TemplateService spec exactly.
 */
export interface ITemplateService {
  render(
    templateId: string,
    variables: Record<string, string>,
  ): Promise<{ subject?: string; body: string }>;
}

export const TEMPLATE_SERVICE = Symbol('TEMPLATE_SERVICE');

/** No-op stub — returns empty body until real TemplateModule is wired */
export class TemplateStubService implements ITemplateService {
  async render(
    _templateId: string,
    _variables: Record<string, string>,
  ): Promise<{ subject?: string; body: string }> {
    return { body: '' };
  }
}
