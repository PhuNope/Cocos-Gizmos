import type { Component } from 'cc';
import {
    Point, Field, camera, readField, handleWorldOrigin, validPoint,
    projectMovePoint, projectedMoveGeometry, markerSize, rotationPlacement,
} from './GizmoViewportGeometry';
import { rotationRingDistanceSquared } from './RotationHandleGeometry';
import { centerDistanceSquared, distanceToSegmentSquared,
    insideProjectedPlane, rectContains, ScreenPoint } from './MoveHitGeometry';
import { hudControlScreenRect } from './GizmoHudControls';
import type { HudControl } from './GizmoHudControls';
import type { GizmoHudPlacement } from './GizmoHudLayout';

/** Input ports use descriptors, not native BoxCollider or MeshRenderer nodes. */
export interface HandleHitTarget { key: string; field: Field }
export interface HudHitTarget { key: string; control: HudControl; index: number }

export function hitTestHandle(
    component: Component, targets: readonly HandleHitTarget[],
    pointer: ScreenPoint, view: any = camera(),
): HandleHitTarget | null {
    if (!component?.node?.isValid || !Number.isFinite(pointer.x) ||
        !Number.isFinite(pointer.y) || typeof view?.worldToScreen !== 'function')
        return null;
    view.sync?.();
    let plane: HandleHitTarget | null = null, axis: HandleHitTarget | null = null;
    let ring: HandleHitTarget | null = null, box: HandleHitTarget | null = null;
    let point: HandleHitTarget | null = null;
    let planeScore=Infinity, axisScore=Infinity, ringScore=Infinity;
    let boxScore=Infinity, pointScore=Infinity;
    const hasBox = targets.some(target => target.field.visual === 'box');
    for (const target of targets) {
        const local=readField(component,target.field);
        if (!local) continue;
        const world=handleWorldOrigin(component,target.field,local);
        if (!validPoint(world)) continue;
        const geometry=projectedMoveGeometry(component,target.field,local,world,view);
        if (geometry?.type==='rotation' && geometry.ring) {
            const pivot=projectMovePoint(view,world);
            const dead=Math.min(20,(target.field.ringSize??72)*0.25);
            if (pivot && (pointer.x-pivot.x)**2+(pointer.y-pivot.y)**2 < dead**2)
                continue;
            const distance=rotationRingDistanceSquared(pointer,geometry.ring);
            const radius=target.field.pickSize??14;
            const placement=rotationPlacement(component,target.field,local,world,
                markerSize(world)/22);
            const forward=view.node?.forward;
            const facing=placement&&forward ? Math.abs(
                placement.normal.x*forward.x+placement.normal.y*forward.y+
                placement.normal.z*forward.z) /
                Math.max(1e-8,Math.hypot(forward.x,forward.y,forward.z)) : 0;
            const score=distance+36*(1-Math.min(1,facing));
            if (distance<=radius*radius && score<ringScore) {
                ring=target;ringScore=score;
            }
            continue;
        }
        if (geometry?.type==='plane' && geometry.corners) {
            if (insideProjectedPlane(pointer,geometry.corners,3)) {
                const distance=centerDistanceSquared(pointer,geometry.rect);
                if (distance<planeScore){plane=target;planeScore=distance;}
            }
            continue;
        }
        if (geometry?.type==='axis' && geometry.axis) {
            const {start,end}=geometry.axis;
            const distance=distanceToSegmentSquared(pointer,start,end);
            const dx=end.x-start.x,dy=end.y-start.y;
            const lenSq=dx*dx+dy*dy;
            const along=lenSq>1e-5 ?
                ((pointer.x-start.x)*dx+(pointer.y-start.y)*dy)/lenSq:-1;
            if (along >= (hasBox?0.15:-0.1) &&
                distance <= (target.field.pickSize??28)**2 &&
                distance<axisScore) {axis=target;axisScore=distance;}
            continue;
        }
        if (geometry?.type==='box') {
            if (rectContains(pointer,geometry.rect)) {
                const distance=centerDistanceSquared(pointer,geometry.rect);
                if(distance<boxScore){box=target;boxScore=distance;}
            }
            continue;
        }
        const projected=projectMovePoint(view,world);
        if(!projected)continue;
        const distance=(projected.x-pointer.x)**2+(projected.y-pointer.y)**2;
        if(distance<=(target.field.pickSize??18)**2 && distance<pointScore) {
            point=target;pointScore=distance;
        }
    }
    return ring||plane||axis||box||point;
}

export function hitTestHud(
    pointer: ScreenPoint, viewport: {width:number;height:number},
    placement: GizmoHudPlacement, targets: readonly HudHitTarget[],
    totalRows: number,
): HudHitTarget | null {
    if (!Number.isFinite(pointer.x)||!Number.isFinite(pointer.y)||
        !viewport||!placement) return null;
    for(const target of targets) {
        const rect=hudControlScreenRect(viewport,
            placement.startRow+placement.textCount+target.index,
            totalRows, target.control.size);
        if(rectContains(pointer,rect))return target;
    }
    return null;
}
