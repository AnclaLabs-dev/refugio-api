import { z } from "zod";

export const isoDateSchema = (field: string) =>
  z
    .string({ error: `${field} debe ser una fecha` })
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${field} debe tener el formato YYYY-MM-DD`)
    .refine((value) => {
      const time = Date.parse(`${value}T00:00:00Z`);
      return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
    }, `${field} no es una fecha válida`);
