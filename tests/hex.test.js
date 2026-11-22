import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step, distance, line, boardFrom, tileHexes, turn } from '../src/engine/hex.js';
import { isRear } from '../src/engine/combat.js';

test('neighbours and distance in doubled coordinates', () => {
    assert.equal(step('2,4', 0), '2,2');
    assert.equal(step('2,4', 1), '3,3');
    assert.equal(step('2,4', 4), '1,5');
    for (let dir = 0; dir < 6; dir++) assert.equal(distance('5,5', step('5,5', dir)), 1);
    assert.equal(distance('0,0', '0,6'), 3);
    assert.equal(distance('0,0', '3,3'), 3);
    assert.equal(distance('0,0', '4,0'), 4);
    assert.equal(distance('0,0', '2,6'), 4);
});

test('lines stop at the board edge and include the start', () => {
    const board = boardFrom({ 0: '0-4', 1: '1-3', 2: '0-4' });
    assert.deepEqual(line(board, '0,0', 3), ['0,0', '0,2', '0,4']);
    assert.deepEqual(line(board, '0,0', 2), ['0,0', '1,1', '2,2']);
    assert.deepEqual(line(board, '0,0', 0), ['0,0']);
});

test('land tiles cover 5 hexes in both orientations', () => {
    assert.deepEqual(tileHexes({ hex: [0, 0], rot: 0 }), ['0,0', '0,2', '0,4', '1,1', '1,3']);
    assert.deepEqual(tileHexes({ hex: [1, 5], rot: 180 }), ['1,5', '1,7', '1,9', '0,6', '0,8']);
});

test('rear attacks (errata, D-1)', () => {
    // target facing N (0): the firing line hits a rear edge if it travels N, NE or NW
    assert.ok(isRear(0, 0));
    assert.ok(isRear(1, 0));
    assert.ok(isRear(5, 0));
    assert.ok(!isRear(2, 0));
    assert.ok(!isRear(3, 0));
    assert.equal(turn(0, -1), 5);
});
