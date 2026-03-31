import { PROJECT_COLORS } from "../../lib/constants";

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <div className="flex gap-2">
      {PROJECT_COLORS.map((color) => (
        <button
          key={color}
          onClick={() => onChange(color)}
          className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110"
          style={{
            backgroundColor: color,
            borderColor: value === color ? "#fff" : "transparent",
          }}
        />
      ))}
    </div>
  );
}
