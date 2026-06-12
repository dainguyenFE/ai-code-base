"use client";

interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchBox({ value, onChange, placeholder }: SearchBoxProps) {
  return (
    <input
      className="h-9 w-full rounded-md border bg-background px-3 text-sm"
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder ?? "Search nodes..."}
      type="search"
      value={value}
    />
  );
}
