import { LinkButton } from '@dpg/ui';
import { ArrowRight, ExternalLink } from 'lucide-react';

export const Primary = () => (
  <LinkButton href="#plan">
    Plan this <ArrowRight data-icon="inline-end" />
  </LinkButton>
);

export const Handoff = () => (
  <div className="flex flex-wrap items-center gap-2">
    <LinkButton variant="outline" href="#website">
      Hotel website <ExternalLink data-icon="inline-end" />
    </LinkButton>
    <LinkButton variant="link" href="#maps">
      See it in Google Maps
    </LinkButton>
  </div>
);
