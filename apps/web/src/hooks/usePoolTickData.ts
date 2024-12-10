import { Currency, V3_CORE_FACTORY_ADDRESSES } from '@uniswap/sdk-core'
import { FeeAmount, Pool, TICK_SPACINGS, tickToPrice } from '@uniswap/v3-sdk'
import { TickData, Ticks } from 'graphql/data/AllV3TicksQuery'
import { PoolState, usePoolMultichain } from 'hooks/usePools'
import JSBI from 'jsbi'
import ms from 'ms'
import { useEffect, useMemo, useState } from 'react'
import { useMultichainContext } from 'state/multichain/useMultichainContext'
import { useAllV3TicksQuery } from 'uniswap/src/data/graphql/uniswap-data-api/__generated__/types-and-hooks'
import { useEnabledChains, useSupportedChainId } from 'uniswap/src/features/chains/hooks'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { toGraphQLChain } from 'uniswap/src/features/chains/utils'
import { logger } from 'utilities/src/logger/logger'
import computeSurroundingTicks, { TickProcessed } from 'utils/computeSurroundingTicks'

const PRICE_FIXED_DIGITS = 8

const getActiveTick = (tickCurrent: number | undefined, feeAmount: FeeAmount | undefined) =>
  tickCurrent && feeAmount ? Math.floor(tickCurrent / TICK_SPACINGS[feeAmount]) * TICK_SPACINGS[feeAmount] : undefined

const MAX_TICK_FETCH_VALUE = 1000
function usePaginatedTickQuery(
  currencyA: Currency | undefined,
  currencyB: Currency | undefined,
  feeAmount: FeeAmount | undefined,
  skip = 0,
  chainId: UniverseChainId,
) {
  const { defaultChainId } = useEnabledChains()

  const poolAddress =
    currencyA && currencyB && feeAmount
      ? Pool.getAddress(
          currencyA?.wrapped,
          currencyB?.wrapped,
          feeAmount,
          undefined,
          chainId ? V3_CORE_FACTORY_ADDRESSES[chainId] : undefined,
        )
      : undefined
  const supportedChainId = useSupportedChainId(chainId)

  return useAllV3TicksQuery({
    variables: {
      address: poolAddress?.toLowerCase() ?? '',
      chain: toGraphQLChain(supportedChainId ?? defaultChainId),
      skip,
      first: MAX_TICK_FETCH_VALUE,
    },
    skip: !poolAddress,
    pollInterval: ms(`30s`),
  })
}

// Fetches all ticks for a given pool
function useAllV3Ticks(
  currencyA: Currency | undefined,
  currencyB: Currency | undefined,
  feeAmount: FeeAmount | undefined,
  chainId: UniverseChainId,
): {
  isLoading: boolean
  error: unknown
  ticks?: TickData[]
} {
  const [skipNumber, setSkipNumber] = useState(0)
  const [tickData, setTickData] = useState<Ticks>([])
  const {
    data,
    error,
    loading: isLoading,
  } = usePaginatedTickQuery(currencyA, currencyB, feeAmount, skipNumber, chainId)
  const ticks: Ticks = data?.v3Pool?.ticks as Ticks

  useEffect(() => {
    if (ticks?.length) {
      setTickData((tickData) => [...tickData, ...ticks])
      if (ticks?.length === MAX_TICK_FETCH_VALUE) {
        setSkipNumber((skipNumber) => skipNumber + MAX_TICK_FETCH_VALUE)
      }
    }
  }, [ticks])

  return {
    isLoading: isLoading || ticks?.length === MAX_TICK_FETCH_VALUE,
    error,
    ticks: tickData,
  }
}

export function usePoolActiveLiquidity(
  currencyA: Currency | undefined,
  currencyB: Currency | undefined,
  feeAmount: FeeAmount | undefined,
  chainId?: UniverseChainId,
): {
  isLoading: boolean
  error: any
  currentTick?: number
  activeTick?: number
  liquidity?: JSBI
  sqrtPriceX96?: JSBI
  data?: TickProcessed[]
} {
  const multichainContext = useMultichainContext()
  const defaultChainId = multichainContext.chainId ?? UniverseChainId.Mainnet
  const pool = usePoolMultichain(currencyA?.wrapped, currencyB?.wrapped, feeAmount, chainId ?? defaultChainId)
  const liquidity = pool[1]?.liquidity
  const sqrtPriceX96 = pool[1]?.sqrtRatioX96

  const currentTick = pool[1]?.tickCurrent
  // Find nearest valid tick for pool in case tick is not initialized.
  const activeTick = useMemo(() => getActiveTick(currentTick, feeAmount), [currentTick, feeAmount])

  const { isLoading, error, ticks } = useAllV3Ticks(currencyA, currencyB, feeAmount, chainId ?? defaultChainId)

  return useMemo(() => {
    if (
      !currencyA ||
      !currencyB ||
      activeTick === undefined ||
      pool[0] !== PoolState.EXISTS ||
      !ticks ||
      ticks.length === 0 ||
      isLoading
    ) {
      return {
        isLoading: isLoading || pool[0] === PoolState.LOADING,
        error,
        activeTick,
        data: undefined,
      }
    }

    const token0 = currencyA?.wrapped
    const token1 = currencyB?.wrapped

    // find where the active tick would be to partition the array
    // if the active tick is initialized, the pivot will be an element
    // if not, take the previous tick as pivot
    const pivot = ticks.findIndex((tickData) => tickData?.tick && tickData.tick > activeTick) - 1

    if (pivot < 0) {
      // consider setting a local error
      logger.debug('usePoolTickData', 'usePoolActiveLiquidity', 'TickData pivot not found', {
        token0: token0.address,
        token1: token1.address,
        chainId: token0.chainId,
      })
      return {
        isLoading,
        error,
        activeTick,
        data: undefined,
      }
    }

    const sdkPrice = tickToPrice(token0, token1, activeTick)
    const activeTickProcessed: TickProcessed = {
      liquidityActive: JSBI.BigInt(pool[1]?.liquidity ?? 0),
      tick: activeTick,
      liquidityNet:
        Number(ticks[pivot]?.tick) === activeTick ? JSBI.BigInt(ticks[pivot]?.liquidityNet ?? 0) : JSBI.BigInt(0),
      price0: sdkPrice.toFixed(PRICE_FIXED_DIGITS),
      sdkPrice,
    }

    const subsequentTicks = computeSurroundingTicks(token0, token1, activeTickProcessed, ticks, pivot, true)

    const previousTicks = computeSurroundingTicks(token0, token1, activeTickProcessed, ticks, pivot, false)

    const ticksProcessed = previousTicks.concat(activeTickProcessed).concat(subsequentTicks)

    return {
      isLoading,
      error,
      currentTick,
      activeTick,
      liquidity,
      sqrtPriceX96,
      data: ticksProcessed,
    }
  }, [currencyA, currencyB, activeTick, pool, ticks, isLoading, error, currentTick, liquidity, sqrtPriceX96])
}
