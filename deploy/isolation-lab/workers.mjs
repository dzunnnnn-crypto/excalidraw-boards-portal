import {IsolatedWorkers} from '../../portal/isolated/workers.mjs';
export class Workers extends IsolatedWorkers {constructor(engine,dataRoot,options={}){super(engine,dataRoot,{...options,fixedDirectories:JSON.parse(process.env.BOARDS_LAB_FIXED_DIRECTORIES||'{}')});}}
