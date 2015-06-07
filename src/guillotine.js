var _ = require('lodash');

var utils = require('./utils');
var common = require('./common');
var Rectangle = common.Rectangle;
var NamedRectangle = common.NamedRectangle;
var Cut = common.Cut;
var Part = common.Part;
var Slate = common.Slate;
var Slates = common.Slates;

var Guillotine = module.exports = function (cutType) {
    if (cutType !== 'v' && cutType !== 'h' && cutType !== 'o') {
        throw new Error('Unknown cut type: ' + cutType);
    }

    this.cutType = cutType;
};

var THRESHOLD = 1000;
Guillotine.prototype.apply = function (slate, parts) {
    var copy = parts.slice(0);
    // TODO: Parts that can be rotated should be sorted further down the list
    var ps = copy.sort((part1, part2) => {
        var primary = part2.w * part2.h - part1.w * part1.h;
        return primary ? primary : ((part1, part2) => {
            if (this.cutType === 'v') {
                return part1.w === part2.w ? part2.h - part1.h : part2.w - part1.w;
            } else if (this.cutType === 'h') {
                return part1.h === part2.h ? part2.w - part1.w : part2.h - part1.h;
            } else if (this.cutType === 'o') {
                return 0;
            }
        })(part1, part2);
    });

    var results = [];
    utils.permute(ps, {threshold: THRESHOLD}, (permutation) => {
        if (permutation) { // if false - skip by threshold
            var result = [];
            var cuts = [];
            var res = this.solution([slate], permutation, result, cuts, 0);
            if (res.success) {
                results.push({
                    rating: utils.rate(res.spares),
                    result: result,
                    cuts: cuts
                });
            }
        }
    });

    return _.max(results, (result) => {
        return result.rating;
    });
};

function rotateNoop (part) {
}

function rotate (part) {
    part.w = part.w ^ part.h;
    part.h = part.w ^ part.h;
    part.w = part.w ^ part.h;
}

var rotateFn = [
    rotateNoop,
    rotate
];

Guillotine.prototype.solution = function (ss, parts, result, cuts, rotationIdx) {
//    console.log(ss, parts, result);
    var slates = new Slates(ss);
    var gen = slates.generator();

    while (slates.hasMore()) {
        // End condition
        if (parts.length === 0) {
            return {
                success: true,
                spares: new Slates(ss)
            };
        }

        var part = parts[0];
        parts.shift();
        rotateFn[rotationIdx](part);

        var slate;
        do {
            slate = gen.next();
//            console.log('Consider', slate, 'for', part);
            if (slate.value) {
                slate.value.marked = true;
            }
        } while (!slate.done && !fitPart(slate.value, part) && !fitPartRotated(slate.value, part));

        // TODO: revisit the next condition, what about slate.done && !slate.value?
        if (slate.done) {
            parts.unshift(part);
            slates.markUnused();
            return {
                success: false
            };
        }

        slates.pop();
        slate = slate.value;

        if (!fitPart(slate, part)) {
            smallerReverse();
            return this.solution(slates.slates, parts, result, cuts, 1);
        }

        var res;
        var shouldKeep;
        var newWidth = slate.rect.w - part.w;
        var newHeight = slate.rect.h - part.h;
        if (this.cutType === 'v') {
            shouldKeep = splitV();
        } else if (this.cutType === 'h') {
            shouldKeep = splitH();
        } else if (this.cutType === 'o') {
            shouldKeep = splitV();
            if (shouldKeep) {
                result.push(new NamedRectangle(part.name, slate.rect.x, slate.rect.y, part.w, part.h));
                res = this.solution(slates.slates, parts, result, cuts, 0);
                if (res.success) {
                    return {
                        success: true,
                        spares: res.spares
                    };
                } else {
                    reverse();
                    result.pop();
                    res = this.solution(slates.slates, parts, result, cuts, 1);
                    if (res.success) {
                        return {
                            success: true,
                            spares: res.spares
                        };
                    } else {
                        reverse();
                        result.pop();
                        shouldKeep = splitH();
                    }
                }
            } else {
                if (newWidth) {
                    slates.shift();
                    cuts.pop();
                }
                if (newHeight) {
                    slates.shift();
                    cuts.pop();
                }
                shouldKeep = splitH();
                if (shouldKeep) {
                    result.push(new NamedRectangle(part.name, slate.rect.x, slate.rect.y, part.w, part.h));
                    res = this.solution(slates.slates, parts, result, cuts, 0);
                    if (res.success) {
                        return {
                            success: true,
                            spares: res.spares
                        };
                    } else {
                        reverse();
                        result.pop();
                        res = this.solution(slates.slates, parts, result, cuts, 1);
                        if (res.success) {
                            return {
                                success: true,
                                spares: res.spares
                            };
                        } else {
                            reverse();
                            result.pop();
                            shouldKeep = splitV();
                        }
                    }
                }
            }
        }

        result.push(new NamedRectangle(part.name, slate.rect.x, slate.rect.y, part.w, part.h));

        if (shouldKeep) {
            res = this.solution(slates.slates, parts, result, cuts, 0);
            if (res.success) {
                return {
                    success: true,
                    spares: res.spares
                };
            }
        } else {
            smallReverse();
            return this.solution(slates.slates, parts, result, cuts, 1);
        }

        reverse();
        smallReverse();

        if (rotationIdx === 0) {
            return this.solution(slates.slates, parts, result, cuts, 1);
        }

        return {
            success: false
        };
    }

    slates.markUnused();
    return {
        success: false
    };

    function smallerReverse () {
        slates.push(slate); // Put slate at end so another one is picked
        rotateFn[rotationIdx](part);
        parts.unshift(part);
    }

    function smallReverse () {
        result.pop();
        smallerReverse();
    }

    function reverse () {
        // Reverse everything
        if (newHeight) {
            slates.shift();
            cuts.pop();
        }
        if (newWidth) {
            slates.shift();
            cuts.pop();
        }
    }

    function splitH () {
        var area1 = newWidth * part.h;
        var area2 = slate.rect.w * newHeight;
        var rotatedNewWidth, rotatedNewHeight, rotatedArea1, rotatedArea2;

        if (part.canRotate && rotationIdx === 0) {
            rotatedNewWidth = slate.rect.h - part.h;
            rotatedNewHeight = slate.rect.w - part.w;
            rotatedArea1 = rotatedNewWidth * part.w;
            rotatedArea2 = slate.rect.h * rotatedNewHeight;

            if (area1 >= area2 && rotatedArea1 > area1 ||
                    area2 >= area1 && rotatedArea2 > area2) {
                return false;
            } else {
                return splitNormalH();
            }
        } else {
            return splitNormalH();
        }

        function splitNormalH () {
            if (area1 > area2) {
                splitHH();
                splitHV();
            } else {
                splitHV();
                splitHH();
            }

            return true;
        }
    }

    function splitV () {
        var area1 = newWidth * slate.rect.h;
        var area2 = part.w * newHeight;
        var rotatedNewWidth, rotatedNewHeight, rotatedArea1, rotatedArea2;

        if (part.canRotate && rotationIdx === 0) {
            rotatedNewWidth = slate.rect.h - part.h;
            rotatedNewHeight = slate.rect.w - part.w;
            rotatedArea1 = newWidth * slate.rect.w;
            rotatedArea2 = part.h * newHeight;

            if (area1 >= area2 && rotatedArea1 > area1 ||
                    area2 >= area1 && rotatedArea2 > area2) {
                return false;
            } else {
                return splitNormalV();
            }
        } else {
            return splitNormalV();
        }


        function splitNormalV () {
            if (area1 > area2) {
                splitVH();
                splitVV();
            } else {
                splitVV();
                splitVH();
            }

            return true;
        }
    }

    function splitVH () {
        if (newWidth) {
            slates.unshift(new Slate(new Rectangle(slate.rect.x + part.w, slate.rect.y, newWidth, slate.rect.h)));
            cuts.push(new Cut(part.name, slate.rect.x + part.w, slate.rect.y, slate.rect.x + part.w, slate.rect.y + slate.rect.h));
        }
    }

    function splitVV () {
        if (newHeight) {
            slates.unshift(new Slate(new Rectangle(slate.rect.x, slate.rect.y + part.h, part.w, newHeight)));
            cuts.push(new Cut(part.name, slate.rect.x, slate.rect.y + part.h, slate.rect.x + part.w, slate.rect.y + part.h));
        }
    }

    function splitHH () {
        if (newWidth) {
            slates.unshift(new Slate(new Rectangle(slate.rect.x + part.w, slate.rect.y, newWidth, part.h)));
            cuts.push(new Cut(part.name, slate.rect.x + part.w, slate.rect.y, slate.rect.x + part.w, slate.rect.y + part.h));
        }
    }

    function splitHV () {
        if (newHeight) {
            slates.unshift(new Slate(new Rectangle(slate.rect.x, slate.rect.y + part.h, slate.rect.w, newHeight)));
            cuts.push(new Cut(part.name, slate.rect.x, slate.rect.y + part.h, slate.rect.x + slate.rect.w, slate.rect.y + part.h));
        }
    }

    function fitPart (slate, part) {
        return part.w <= slate.rect.w && part.h <= slate.rect.h;
    }

    function fitPartRotated (slate, part) {
        return part.canRotate && rotationIdx === 0 && part.w <= slate.rect.h && part.h <= slate.rect.w;
    }
};
