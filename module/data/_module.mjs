import { CharacterData } from "./actor/character.mjs";
import { MonsterData } from "./actor/monster.mjs";
import { WeaponData, ArmorData, GearData, SpellData, ProfessionData, RaceData, CritWoundData, ComponentData, RecipeData,
  AlchemicalData, EnhancementData } from "./item/items.mjs";

export const ACTOR_MODELS = {
  character: CharacterData,
  monster: MonsterData
};

export const ITEM_MODELS = {
  weapon: WeaponData,
  armor: ArmorData,
  gear: GearData,
  spell: SpellData,
  profession: ProfessionData,
  race: RaceData,
  critWound: CritWoundData,
  component: ComponentData,
  recipe: RecipeData,
  alchemical: AlchemicalData,
  enhancement: EnhancementData
};
