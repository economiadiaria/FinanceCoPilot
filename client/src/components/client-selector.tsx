import { useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Client } from "@shared/schema";

interface ClientSelectorProps {
  clients: Client[];
  selectedClient: string | null;
  onSelectClient: (clientId: string) => void;
  onNewClient?: () => void;
}

export function ClientSelector({
  clients,
  selectedClient,
  onSelectClient,
  onNewClient,
}: ClientSelectorProps) {
  const [open, setOpen] = useState(false);

  const selected = clients.find((c) => c.clientId === selectedClient);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[280px] justify-between"
          data-testid="button-client-selector"
        >
          <span className="truncate">
            {selected ? (
              <>
                <span className="font-semibold">{selected.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {selected.type}
                </span>
              </>
            ) : (
              "Selecione um cliente..."
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0">
        <Command>
          <CommandInput placeholder="Buscar cliente..." />
          <CommandList>
            <CommandEmpty>Nenhum cliente encontrado.</CommandEmpty>
            <CommandGroup>
              {clients.map((client) => (
                <CommandItem
                  key={client.clientId}
                  value={client.clientId}
                  onSelect={(currentValue) => {
                    onSelectClient(currentValue);
                    setOpen(false);
                  }}
                  data-testid={`client-option-${client.clientId}`}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selectedClient === client.clientId ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex flex-col">
                    <span className="font-medium">{client.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {client.type} • {client.email || "Sem email"}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {onNewClient && (
            <div className="border-t p-2">
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  onNewClient();
                  setOpen(false);
                }}
                data-testid="button-new-client"
              >
                <Plus className="mr-2 h-4 w-4" />
                Novo cliente
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
