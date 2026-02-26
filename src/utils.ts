import {DevToolsMessage, TableEntry} from "./types";

export const isTableEntry = (a: unknown): a is TableEntry =>
  typeof a === 'object' && !!a && 'x' in a && 'y' in a && 'z' in a


export const isDevToolsMessage = (a: unknown): a is DevToolsMessage =>
  typeof a === 'object' && !!a && 'type' in a
