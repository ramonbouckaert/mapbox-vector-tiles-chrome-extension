import {DevToolsMessage, TableEntry} from "./types";
import {Hashery} from "hashery";

export const isTableEntry = (a: unknown): a is TableEntry =>
  typeof a === 'object' && !!a && 'x' in a && 'y' in a && 'z' in a

export const isDevToolsMessage = (a: unknown): a is DevToolsMessage =>
  typeof a === 'object' && !!a && 'type' in a

const hasher = new Hashery()

export const hashTableEntry = async (tableEntry: TableEntry): Promise<string> => {
  return await hasher.toHash({
    x: tableEntry.x,
    y: tableEntry.y,
    z: tableEntry.z,
    url: tableEntry.url,
    startedDateTime: tableEntry.startedDateTime,
    startOrder: tableEntry.startOrder,
  })
};
