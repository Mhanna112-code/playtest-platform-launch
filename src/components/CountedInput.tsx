"use client";
import { useState, type InputHTMLAttributes } from "react";
import { CharacterCount } from "@/components/CharacterCount";

export function CountedInput({ minLength = 0, maxLength, ...props }: InputHTMLAttributes<HTMLInputElement> & { maxLength: number }) {
  const [typed, setTyped] = useState(String(props.defaultValue ?? ""));
  const value = props.value != null ? String(props.value) : typed;
  return <><input {...props} minLength={minLength} maxLength={maxLength} onChange={(e) => { setTyped(e.target.value); props.onChange?.(e); }} /><CharacterCount value={value} min={minLength} max={maxLength} required={props.required} /></>;
}
