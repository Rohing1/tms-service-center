package com.admin.servicecenter;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class RenewalPolicyTest {
    @Test void futureAndExpiredDatesUseCorrectBaseAndQuotaModes(){
        long now=1000000000L,day=86400000L;
        assertEquals(now+40*day,RenewalPolicy.calculate(100L,now+10*day,30,"keep",0,now).expTime());
        assertEquals(now+30*day,RenewalPolicy.calculate(100L,now-day,30,"add",50,now).expTime());
        assertEquals(150,RenewalPolicy.calculate(100L,now-day,30,"add",50,now).quotaGb());
        assertEquals(0,RenewalPolicy.calculate(100L,now+day,0,"set",0,now).quotaGb());
    }
    @Test void unlimitedAndNoOpDoNotSilentlyChangeTerms(){
        assertThrows(IllegalArgumentException.class,()->RenewalPolicy.calculate(100L,0L,30,"keep",0,1));
        assertThrows(IllegalArgumentException.class,()->RenewalPolicy.calculate(0L,100L,0,"add",50,1));
        assertThrows(IllegalArgumentException.class,()->RenewalPolicy.calculate(100L,100L,0,"keep",0,1));
        assertThrows(IllegalArgumentException.class,()->RenewalPolicy.calculate(1000000L,100L,0,"add",1,1));
    }
}
