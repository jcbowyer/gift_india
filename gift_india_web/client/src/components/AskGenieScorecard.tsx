import { useMemo, useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  GenieChatInput,
  GenieChatMessageList,
  useGenieChat,
} from '@databricks/appkit-ui/react';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import {
  GIFT_GENIE_ALIAS,
  GIFT_GENIE_FRAMEWORK,
  giftGenieContextualizeQuestion,
  giftGenieFacilityPrompts,
  giftGenieGlobalPrompts,
  type GiftGenieFacilityContext,
} from '../lib/giftGenie';

function AskGeniePanel({ facility }: { facility: GiftGenieFacilityContext | null }) {
  const { messages, status, sendMessage, error } = useGenieChat({
    alias: GIFT_GENIE_ALIAS,
    persistInUrl: false,
  });
  const prompts = useMemo(
    () => (facility ? giftGenieFacilityPrompts(facility) : giftGenieGlobalPrompts()),
    [facility],
  );
  const busy = status === 'streaming' || status === 'loading-history';

  const ask = (question: string) => {
    sendMessage(giftGenieContextualizeQuestion(question, facility));
  };

  return (
    <div className="flex h-[min(28rem,60vh)] flex-col overflow-hidden rounded-lg border bg-card">
      <div className="shrink-0 space-y-2 border-b bg-gradient-to-r from-primary/5 to-amber-50/40 px-3 py-2.5">
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">GIFT Genie</span> — {GIFT_GENIE_FRAMEWORK}
          {' '}Queries governed <code className="text-[11px]">workspace.gift_serving.*</code> (synced from Lakebase{' '}
          <code className="text-[11px]">gold.*</code>); it does not change scorecard grades or clear human-review flags.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {prompts.map((q) => (
            <Button
              key={q}
              type="button"
              variant="outline"
              size="sm"
              className="h-auto max-w-full whitespace-normal border-primary/20 bg-background/80 px-2.5 py-1 text-left text-[11px] font-normal leading-snug hover:border-primary/40 hover:bg-primary/5"
              disabled={busy}
              onClick={() => ask(q)}
            >
              {q}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <GenieChatMessageList messages={messages} status={status} className="flex-1" />
        {error ? (
          <p className="shrink-0 border-t bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>
        ) : null}
        <div className="shrink-0 border-t p-2">
          <GenieChatInput
            onSend={ask}
            disabled={busy}
            placeholder={
              facility
                ? `Ask GIFT Genie about ${facility.name} or ${facility.district}…`
                : 'Ask about facility trust, capabilities, districts, or NFHS indicators…'
            }
          />
        </div>
      </div>
    </div>
  );
}

export function AskGenieScorecard({ facility }: { facility: GiftGenieFacilityContext | null }) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="gift-lift border-primary/15" data-demo="ask-genie">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="space-y-0 p-0">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40"
            >
              {open ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20">
                <Sparkles className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-foreground">Ask GIFT Genie</span>
                <span className="block text-xs text-muted-foreground">
                  Governed facility & district analytics
                  {facility ? ` · scorecard: ${facility.name}` : ''}
                </span>
              </span>
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-2 px-4 pb-4 pt-0">
            <AskGeniePanel facility={facility} />
            <p className="text-[11px] text-muted-foreground">
              Answers cite SQL over Unity Catalog (Virtue Foundation share). Scorecard grades and flags come from
              Lakebase <code className="text-[11px]">gold.*</code> — use the capability rows above for per-facility
              trust detail.
            </p>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
