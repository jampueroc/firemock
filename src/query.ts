import { IDictionary } from 'common-types';
import * as firebase from 'firebase-admin';
import { db } from './database';
import { get } from 'lodash';
import SnapShot from './snapshot';
import Queue from './queue';
import Reference from './reference';
import {
  parts,
  normalizeRef,
  leafNode,
  getRandomInt,
  removeKeys
} from './util';

/** named network delays */
export enum Delays {
  random = 'random',
  weak = 'weak-mobile',
  mobile = 'mobile',
  WiFi = 'WIFI'
}
export type DelayType = number | number[] | IDictionary<number> | Delays;

export type QueryValue = number|string|boolean|null;
export type QueryItem = (snap: SnapShot) => SnapShot;
export type QueryStack = QueryItem[];
export enum OrderingType {
  byChild = 'child',
  byKey = 'key',
  byValue = 'value'
}
export interface IOrdering {
  type: OrderingType;
  value: any;
}

export interface IListener {
  path: string,

  eventType: firebase.database.EventType,
  callback: (a: admin.database.DataSnapshot | null, b?: string) => any,
  cancelCallbackOrContext?: object | null,
  context?: object | null
}

export type IQueryFilter<T> = (snap: SnapShot<T>) => SnapShot<T>;

export default class Query<T = any> 
  implements firebase.database.Query {
  protected _query: QueryStack = [];
  protected _order: IOrdering;
  protected _listeners = new Queue<IListener>('listeners');
  
  constructor(public path: string, protected _delay: DelayType = 5) {}

  public get ref(): firebase.database.Reference {
    return new Reference<T>(this.path, this._delay);
  }
  
  public limitToLast(num: number) {
    const filter: IQueryFilter<T> = (snap: SnapShot<T>) => {
      let js: any = snap.val() as T;
      const size: number = Object.keys(js).length;
      if (typeof js === 'object') {
        const remove = Object.keys(js).slice(0, size - num);
        js = removeKeys(js, remove);
      }

      return new SnapShot(snap.key, js);
    }
    this._query.push(filter);

    return this;
  }

  public limitToFirst(num: number) {
    const filter: IQueryFilter<T> = (snap: SnapShot<T>) => {
      let js: any = snap.val() as T;
      const size: number = Object.keys(js).length;
      if (typeof js === 'object') {
        const remove = Object.keys(js).slice(num);
        js = removeKeys(js, remove);
      }

      return new SnapShot(snap.key, js);
    }
    this._query.push(filter);

    return this;
  }

  public equalTo(value: QueryValue, key?: string) {
    const filter: IQueryFilter<T> = (snap: SnapShot<T>) => {
      let js: any = snap.val() as T;
      const remove = Object.keys(js).filter(k => js[k][key] !== value);
      js = removeKeys(js, remove);
      return new SnapShot(snap.key, js);
    }
    this._query.push(filter);

    return this;
  }

  public startAt(value: QueryValue, key?: string) {
    const filter: IQueryFilter<T> = (snap: SnapShot<T>) => {
      let js: any = snap.val() as T;
      const remove = Object.keys(js).filter(k => js[k][key] < value);
      js = removeKeys(js, remove);
      return new SnapShot(snap.key, js);
    };
    this._query.push(filter);

    return this;
  }

  public endAt(value: QueryValue, key?: string) {
    const filter: IQueryFilter<T> = (snap: SnapShot<T>) => {
      let js: any = snap.val() as T;
      const remove = Object.keys(js).filter(k => js[k][key] > value);
      js = removeKeys(js, remove);
      return new SnapShot(snap.key, js);
    };
    this._query.push(filter);

    return this;
  } 

  public on(
    eventType: firebase.database.EventType,
    callback: (a: admin.database.DataSnapshot | null, b?: string) => any,
    cancelCallbackOrContext?: object | null,
    context?: object | null
  ): (a: admin.database.DataSnapshot | null, b?: string) => any {

    this._listeners.push({
      path: this.path,

      eventType,
      callback,
      cancelCallbackOrContext,
      context
    })

    return null;
  }

  public once(eventType: 'value'): Promise<SnapShot<T>> {
    const snapshot = this.processQueriesAndSorts();
    return new Promise(resolve => {
      setTimeout(() => resolve(snapshot), this.delay());
    });
  }

  public onceSync(eventType: 'value'): SnapShot<T> {
    return this.processQueriesAndSorts();
  }  

  public off() {
    console.log('on() not implemented yet');
  }

  /** NOT IMPLEMENTED YET */
  public isEqual(other: firebase.database.Query) {
    return false;
  }

  /**
   * When the children of a query are all objects, then you can sort them by a
   * specific property. Note: if this happens a lot then it's best to explicitly
   * index on this property in the database's config.
   */
  public orderByChild(prop: string) {
    this._order = {
      type: OrderingType.byChild,
      value: prop
    };

    return this;
  }

  /**
   * When the children of a query are all scalar values (string, number, boolean), you
   * can order the results by their (ascending) values
   */
  public orderByValue() {
    this._order = {
      type: OrderingType.byValue,
      value: null
    };

    return this;
  }

  /**
   * This is the default sort
   */
  public orderByKey() {
    this._order = {
      type: OrderingType.byKey,
      value: null
    };

    return this;
  }

  /** NOT IMPLEMENTED */
  public orderByPriority() {
    return this;
  }

  public toJSON() {
    return JSON.stringify(this);
  }

  public toString() {
    return `${process.env.FIREBASE_DATA_ROOT_URL}/${this.path}`;
  }
  
  /**
   * Processes all the queries and sorts that have been queued up
   */
  private processQueriesAndSorts(): SnapShot<T> {
    const response = get(db, normalizeRef(this.path), undefined);
    let snapshot: any = new SnapShot<T>(leafNode(this.path), response);
    // TODO: sort 
    this._query.forEach(q => (snapshot = q(snapshot)));

    return snapshot as SnapShot<T>;
  }

  private delay() {
    const delay = this._delay as IDictionary | number | number[] | Delays;
    if (typeof delay === 'number') {
      return delay;
    }

    if (Array.isArray(delay)) {
      const [min, max] = delay;
      return getRandomInt(min, max);
    }

    if (typeof delay === 'object' && !Array.isArray(delay)) {
      const { min, max } = delay;
      return getRandomInt(min, max);
    }

    // these numbers need some reviewing
    if (delay === 'random') {
      return getRandomInt(10, 300);
    }
    if (delay === 'weak') {
      return getRandomInt(400, 900);
    }
    if (delay === 'mobile') {
      return getRandomInt(300, 500);
    }
    if (delay === 'WIFI') {
      return getRandomInt(10, 100);
    }

    throw new Error('Delay property is of unknown format: ' + delay);
  }
}
