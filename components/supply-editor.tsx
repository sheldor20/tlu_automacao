import type { ConstructionSupply } from "@/lib/types";
import { remainingSupplyQuantity, supplyWithRemainingQuantity } from "@/lib/construction-supplies";
import { Plus, Trash2 } from "lucide-react";

const emptySupply = (): ConstructionSupply => ({
  name: "",
  total_value: 0,
  total_quantity: 0,
  used_quantity: 0,
});

export function SupplyEditor({
  value,
  onChange,
}: {
  value: ConstructionSupply[];
  onChange: (supplies: ConstructionSupply[]) => void;
}) {
  function update(index: number, patch: Partial<ConstructionSupply>) {
    onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  return (
    <div className="supply-editor form-span-2">
      <div className="supply-editor-head">
        <div>
          <strong>Insumos</strong>
          <span>Informe o total adquirido e o estoque atual. O consumo é calculado automaticamente.</span>
        </div>
        <button type="button" onClick={() => onChange([...value, emptySupply()])}>
          <Plus size={15} /> Adicionar insumo
        </button>
      </div>
      {value.length ? (
        <div className="supply-editor-list">
          {value.map((item, index) => (
            <div className="supply-editor-row" key={index}>
              <label className="supply-name">
                <span>Nome do item</span>
                <input
                  value={item.name}
                  onChange={(event) => update(index, { name: event.target.value })}
                  maxLength={140}
                  required
                />
              </label>
              <label>
                <span>Valor total</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.total_value}
                  onChange={(event) => update(index, { total_value: Number(event.target.value) })}
                  required
                />
              </label>
              <label>
                <span>Qtd. total</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.total_quantity}
                  onChange={(event) => {
                    const total = Number(event.target.value);
                    update(index, { total_quantity: total, used_quantity: Math.min(item.used_quantity, total) });
                  }}
                  required
                />
              </label>
              <label>
                <span>Estoque atual</span>
                <input
                  type="number"
                  min="0"
                  max={item.total_quantity}
                  step="0.01"
                  value={remainingSupplyQuantity(item)}
                  onChange={(event) => update(index, supplyWithRemainingQuantity(item, Number(event.target.value)))}
                  required
                />
                <small>{remainingSupplyQuantity(item) < Number(item.total_quantity || 0) ? `${Number(item.used_quantity || 0).toLocaleString("pt-BR")} consumidos` : "Sem consumo registrado"}</small>
              </label>
              <button
                type="button"
                className="supply-remove"
                onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
                aria-label={`Remover ${item.name || "insumo"}`}
                title="Remover insumo"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="supply-editor-empty">Nenhum insumo informado.</div>
      )}
    </div>
  );
}
