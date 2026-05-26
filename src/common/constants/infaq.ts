import { AnimalType } from '../enums/animal-type.enum';

export const INFAQ_AMOUNT: Record<string, number> = {
  [AnimalType.DOMBA]: 300000,
  [AnimalType.KAMBING]: 300000,
  [AnimalType.SAPI_KOLEKTIF]: 300000,
  [AnimalType.SAPI_KOLEKTIF_A]: 300000,
  [AnimalType.SAPI_KOLEKTIF_B]: 300000,
  [AnimalType.SAPI_KOLEKTIF_C]: 300000,
  [AnimalType.SAPI_PERORANGAN]: 1750000,
};

export function getInfaqAmount(animalType: string): number {
  return INFAQ_AMOUNT[animalType] || 0;
}
