import { PoolCategory } from 'config/constants/types'
import BigNumber from 'bignumber.js'
import _toNumber from 'lodash/toNumber'
import _get from 'lodash/get'
import { FixedNumber } from '@ethersproject/bignumber'
import { BIG_ZERO } from '@pancakeswap/utils/bigNumber'
import { SECONDS_IN_YEAR } from 'config'

import { ACC_CAKE_PRECISION } from '../constants'
import getFarmTokenPerSecond from '../utils/getFarmTokenPerSecond'

export const getPoolApr = ({ rewardTokenPrice, stakingTokenPrice, tokenPerSecond, totalStaked }) => {
  const totalRewardPricePerYear = new BigNumber(rewardTokenPrice).times(tokenPerSecond).times(SECONDS_IN_YEAR)
  const totalStakingTokenInPool = new BigNumber(stakingTokenPrice).times(totalStaked)
  const apr = totalRewardPricePerYear.div(totalStakingTokenInPool).times(100)
  return apr.isNaN() || !apr.isFinite() ? null : apr.toNumber()
}

export function getRewardPerSecondOfCakeFarm({
  cakePerSecond,
  specialRate,
  regularRate,
  allocPoint,
  specialAllocPoint,
}) {
  const fSpecialRate = FixedNumber.from(specialRate)
  const fRegularRate = FixedNumber.from(regularRate)

  const cakeRate = fSpecialRate.divUnsafe(fSpecialRate.addUnsafe(fRegularRate))

  return FixedNumber.from(cakePerSecond)
    .mulUnsafe(cakeRate.mulUnsafe(FixedNumber.from(allocPoint)).divUnsafe(FixedNumber.from(specialAllocPoint)))
    .toString()
}

const transformCakePool = ({
  balances,
  cakePoolInfo,
  userInfo,
  masterChefData,
  cakeFarm,
  chainId,
  earningTokenPrice,
}) => {
  const currentRewardDebt = _get(userInfo, 'reward_debt', '0')
  const userStakedAmount = _get(userInfo, 'amount', '0')

  const rewardPerSecond = getRewardPerSecondOfCakeFarm({
    cakePerSecond: masterChefData.cake_per_second,
    specialRate: masterChefData.cake_rate_to_special,
    regularRate: masterChefData.cake_rate_to_regular,
    allocPoint: cakePoolInfo.alloc_point,
    specialAllocPoint: masterChefData.total_special_alloc_point,
  })

  let userData = {
    allowance: new BigNumber(0),
    pendingReward: new BigNumber(0),
    stakedBalance: new BigNumber(0),
    stakingTokenBalance: new BigNumber(0),
  }

  const foundStakingBalance = balances.find(
    (balance) => balance.type === `0x1::coin::CoinStore<${cakeFarm.token.address}>`,
  )

  const amount = _get(foundStakingBalance, 'data.coin.value')

  if (amount) {
    userData = { ...userData, stakingTokenBalance: new BigNumber(amount) }
  }

  const totalStake = _get(cakePoolInfo, 'total_amount', '0')

  if (_toNumber(userStakedAmount) && _toNumber(totalStake)) {
    const pendingReward = getFarmTokenPerSecond({
      lastRewardTimestamp: _toNumber(cakePoolInfo.last_reward_timestamp),
      rewardPerSecond,
      currentRewardDebt,
      tokenPerShare: cakePoolInfo.acc_cake_per_share,
      precisionFactor: ACC_CAKE_PRECISION,
      totalStake: cakePoolInfo.total_amount,
      userStakedAmount,
    })

    userData = {
      ...userData,
      pendingReward: new BigNumber(pendingReward.toString()),
      stakedBalance: new BigNumber(userStakedAmount),
    }
  }

  const apr = getPoolApr({
    rewardTokenPrice: _toNumber(earningTokenPrice),
    stakingTokenPrice: _toNumber(earningTokenPrice),
    tokenPerSecond: rewardPerSecond,
    totalStaked: cakePoolInfo.total_amount,
  })

  return {
    sousId: cakeFarm.pid,
    contractAddress: {
      [chainId]: cakeFarm.lpAddress,
    },
    stakingToken: cakeFarm.token,
    earningToken: cakeFarm.token,
    apr,
    earningTokenPrice: _toNumber(earningTokenPrice),
    stakingTokenPrice: _toNumber(earningTokenPrice),

    isFinished: false,
    poolCategory: PoolCategory.CORE,
    startBlock: 0,
    tokenPerBlock: rewardPerSecond,
    stakingLimit: BIG_ZERO,
    totalStaked: new BigNumber(cakePoolInfo.total_amount),

    userData,

    profileRequirement: undefined,
  }
}

export default transformCakePool
